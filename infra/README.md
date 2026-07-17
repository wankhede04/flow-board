# FlowBoard on AWS ECS Fargate (Terraform)

A managed, horizontally-scalable deployment: RDS Postgres, ECS Fargate (ARM64,
1 task by default), an ALB with an ACM certificate, CloudWatch logging/alarms,
and background jobs (reminders, due-date/stale scans) driven by EventBridge
Scheduler instead of the in-process scheduler. Sized and priced for a small
internal team — see the comments in `variables.tf` for what to change if you
outgrow that.

This is the recommended path once you've outgrown the single-VM
docker-compose deployment in the main [`DEPLOYMENT.md`](../DEPLOYMENT.md).

> **Not applied or validated by the author** — this environment had no
> Terraform CLI or AWS credentials. Run `terraform validate` after `init`
> and read the plan carefully before `apply`. Please report anything that
> doesn't match reality so it can be fixed.

## What this creates

VPC (2 public + 2 private subnets, no NAT Gateway — see `vpc.tf` for why),
ECR repository, RDS Postgres 16 (single-AZ, `db.t4g.micro`), ECS cluster +
Fargate service + task definition, Application Load Balancer + ACM
certificate, CloudWatch log group + Container Insights + alarms + SNS topic,
EventBridge Scheduler hitting `/api/v1/jobs/tick` every minute, IAM roles
(ECS task execution/task roles, GitHub Actions OIDC deploy role), and
Secrets Manager entries for all app secrets.

## Prerequisites

- Terraform >= 1.6, an AWS account, and credentials configured locally
  (`aws configure` or equivalent) with permission to create the resources
  above.
- Your domain's DNS (this repo's example uses `abhijeetfoundation.org` via
  GoDaddy — any registrar works the same way, you're just adding CNAME
  records).

## 1. Configure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: at minimum set domain_name
```

## 2. Init and apply

```bash
terraform init
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

**`apply` will pause** on `aws_acm_certificate_validation` waiting for the
certificate to validate (up to 45 minutes). While it's waiting, add the
validation CNAME at your DNS provider:

```bash
terraform output acm_validation_records
```

Add each `{name, type, value}` as a DNS record (type will be `CNAME`) at
your registrar. Once it propagates, ACM validates automatically and
`apply` continues — no need to re-run anything.

If you're impatient and want to see the record before the resource
finishes, open another terminal:
```bash
terraform state show aws_acm_certificate.flowboard
```

## 3. Point your domain at the load balancer

```bash
terraform output alb_dns_name
```

Add a CNAME (or ALIAS, if your provider supports it) at your registrar:
`flowboard.yourdomain.org` → the ALB DNS name above.

## 4. Fill in the application secrets

Terraform created empty secret *shells* for anything it doesn't generate
itself (`JWT_SECRET` and `CRON_SECRET` **are** auto-generated — nothing to
do for those). Set the rest:

```bash
# Slack (see ../DEPLOYMENT.md Step 5 and ../docs/SLACK_CHANNEL_SETUP.md)
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw slack_signing_secret_arn)" \
  --secret-string "<your Slack signing secret>"

aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw slack_bot_token_arn)" \
  --secret-string "xoxb-<your bot token>"

# Google OAuth (see ../DEPLOYMENT.md Step 5b) — redirect URI:
#   https://<domain_name>/api/v1/auth/oauth/google/callback
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw google_client_secret_arn)" \
  --secret-string "<your Google OAuth client secret>"

# GitHub OAuth — callback URL:
#   https://<domain_name>/api/v1/auth/oauth/github/callback
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw github_client_secret_arn)" \
  --secret-string "<your GitHub OAuth client secret>"
```

Also set the matching **client IDs** (not secret — these go in
`terraform.tfvars`, not Secrets Manager):

```bash
# in terraform.tfvars
google_client_id = "xxxxx.apps.googleusercontent.com"
github_client_id = "Iv1.xxxxxxxxxxxxxxxx"
```

```bash
terraform apply  # picks up the client ID change, forces a new task deployment
```

Any of these can be left unset — the corresponding feature (that OAuth
button, Slack) just stays inactive until you fill it in, same as the
docker-compose deployment.

## 5. Wire up GitHub Actions for deploys

The `.github/workflows/deploy-ecs.yml` workflow builds, pushes to ECR, and
rolls out a new task definition on every push to `main`. It authenticates
via OIDC — no AWS keys stored in GitHub. Set these in **GitHub repo →
Settings → Secrets and variables → Actions → Variables** tab (these are
non-secret identifiers, not credentials, which is why they're variables and
not secrets):

```bash
terraform output aws_region        # → AWS_REGION      (this is var.aws_region, add manually)
terraform output github_deploy_role_arn  # → AWS_ROLE_ARN
terraform output ecr_repository_url      # → ECR_REPOSITORY
terraform output ecs_cluster_name        # → ECS_CLUSTER
terraform output ecs_service_name        # → ECS_SERVICE
```

And `ECS_TASK_DEFINITION_FAMILY` = whatever you set `project_name` to in
`terraform.tfvars` (default: `flowboard`).

Push to `main` (or run the workflow manually) and watch it deploy. The
first-ever `apply` used a harmless placeholder image
(`variables.tf`'s `container_image` default) just to get the service
running before any real image existed — this workflow replaces it with
the real one.

## 6. Verify

```bash
curl -fsS https://<your-domain>/api/healthz   # {"status":"ok"}
curl -fsS https://<your-domain>/api/readyz    # {"status":"ready","checks":{"db":"ok"}}

# Jobs tick is being driven by EventBridge Scheduler — check it's actually
# firing (CloudWatch → Log groups → /ecs/flowboard, look for scheduler
# activity), or just wait a minute and check for [scheduler]-style log
# lines... actually the ECS deployment runs with ENABLE_SCHEDULER=false, so
# ticks come from EventBridge instead; verify in the AWS Console under
# EventBridge → Scheduler, or:
aws scheduler get-schedule --name flowboard-jobs-tick --group-name default
```

Then sign in (Google/GitHub, whichever you configured) and confirm the
board loads.

## Notes on cost

Roughly (us-east-1, at rest, ignoring free-tier if you're within 12
months of account creation): ALB ~$16-20/mo, Fargate 0.25vCPU/0.5GB ARM64
~$7-9/mo, RDS db.t4g.micro ~$12-15/mo + storage, Secrets Manager ~$0.40/
secret/mo (7 secrets), CloudWatch Logs/alarms a few dollars. Roughly
**$50-70/mo** all-in for the default sizing. No NAT Gateway (would add
~$32/mo) by design — see `vpc.tf`.

## Tearing down

```bash
terraform destroy
```

Note `db_deletion_protection` defaults to `false` and RDS
`skip_final_snapshot` follows it — fine for throwaway test environments,
but flip `db_deletion_protection = true` in `terraform.tfvars` once this is
a real production database you don't want destroyed by an accidental
`terraform destroy`.
