variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used as a prefix for all resource names."
  type        = string
  default     = "flowboard"
}

variable "domain_name" {
  description = "Public domain the app will be served on (e.g. flowboard.abhijeetfoundation.org). A CNAME/ALIAS must point this at the ALB's DNS name after apply; ACM validation requires an additional DNS record (see outputs)."
  type        = string
}

variable "alert_email" {
  description = "Email address to receive CloudWatch alarm notifications. Leave empty to skip the subscription (you can add one later in the SNS console)."
  type        = string
  default     = ""
}

# --- Sizing (defaults tuned for a small internal team; bump up for growth) ---

variable "task_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU). See AWS docs for valid cpu/memory combinations."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of Fargate tasks to run. Keep at 1 unless you also set enable_scheduler=false and drive jobs from EventBridge Scheduler only (already the default here) to avoid duplicate reminder scans."
  type        = number
  default     = 1
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is the cheapest Graviton option; falls back to db.t3.micro in regions without Graviton RDS."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "RDS automated backup retention period, in days."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Enable RDS deletion protection. Recommended true once this is a real production database; defaults false so early iteration (destroy/recreate) isn't blocked."
  type        = bool
  default     = false
}

# --- Container image ---

variable "container_image" {
  description = "Initial container image for the task definition (ECR URI). The GitHub Actions deploy workflow updates this on every push; this value only matters for the very first `terraform apply` before any image has been pushed to ECR."
  type        = string
  default     = "public.ecr.aws/docker/library/nginx:stable" # harmless placeholder; replaced by the first CI deploy
}

# --- GitHub OIDC (for the deploy workflow) ---

variable "github_repository" {
  description = "GitHub repo allowed to assume the deploy role, as 'owner/repo'."
  type        = string
  default     = "wankhede04/flow-board"
}

variable "create_github_oidc_provider" {
  description = "Whether to create the GitHub Actions OIDC provider. Set to false if your AWS account already has one (an account can only have one OIDC provider per URL — a second `aws_iam_openid_connect_provider` for token.actions.githubusercontent.com will fail to create)."
  type        = bool
  default     = true
}

variable "google_client_id" {
  description = "Google OAuth client ID (public identifier, not a secret — the matching GOOGLE_CLIENT_SECRET is set via Secrets Manager after apply). Leave empty to keep the Google sign-in button hidden."
  type        = string
  default     = ""
}

variable "github_client_id" {
  description = "GitHub OAuth client ID (public identifier, not a secret — the matching GITHUB_CLIENT_SECRET is set via Secrets Manager after apply). Leave empty to keep the GitHub sign-in button hidden."
  type        = string
  default     = ""
}

# --- App secrets (set via `aws secretsmanager put-secret-value` after apply — see infra/README.md) ---
# These are intentionally NOT Terraform variables: putting real secret
# values in .tfvars means they land in Terraform state and (if committed)
# version control. Terraform only creates empty secret *shells*; you fill
# them in out-of-band.
