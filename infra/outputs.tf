output "alb_dns_name" {
  description = "Point your domain's DNS (CNAME/ALIAS) at this."
  value       = aws_lb.flowboard.dns_name
}

output "acm_validation_records" {
  description = "DNS records to add at your domain registrar to validate the ACM certificate. Required before terraform apply's aws_acm_certificate_validation resource will finish."
  value = [
    for r in aws_acm_certificate.flowboard.domain_validation_options : {
      name  = r.resource_record_name
      type  = r.resource_record_type
      value = r.resource_record_value
    }
  ]
}

output "ecr_repository_url" {
  description = "Push images here — set as ECR_REPOSITORY in GitHub Actions."
  value       = aws_ecr_repository.flowboard.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.flowboard.name
}

output "ecs_service_name" {
  value = aws_ecs_service.flowboard.name
}

output "ecs_task_execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}

output "ecs_task_role_arn" {
  value = aws_iam_role.ecs_task.arn
}

output "github_deploy_role_arn" {
  description = "Set as AWS_ROLE_ARN in the GitHub repo's Actions secrets/variables."
  value       = aws_iam_role.github_deploy.arn
}

output "db_endpoint" {
  description = "RDS endpoint (host:port) — for reference; the app reads the full connection string from Secrets Manager."
  value       = aws_db_instance.flowboard.endpoint
  sensitive   = false
}

output "cloudwatch_log_group" {
  value = aws_cloudwatch_log_group.flowboard.name
}

output "sns_alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

# --- Secret ARNs — for the `aws secretsmanager put-secret-value` commands in infra/README.md ---

output "slack_signing_secret_arn" {
  value = aws_secretsmanager_secret.slack_signing_secret.arn
}

output "slack_bot_token_arn" {
  value = aws_secretsmanager_secret.slack_bot_token.arn
}

output "google_client_secret_arn" {
  value = aws_secretsmanager_secret.google_client_secret.arn
}

output "github_client_secret_arn" {
  value = aws_secretsmanager_secret.github_client_secret.arn
}
