# Drives POST /api/v1/jobs/tick every minute — the same external-cron mode
# the app already supports for multi-replica/serverless deploys (see
# src/lib/jobs.ts and README's ENABLE_SCHEDULER note). This decouples
# background jobs (reminders, due-date/stale scans) from replica count
# entirely: the ECS task definition sets ENABLE_SCHEDULER=false, and this
# is the only thing invoking the tick.
#
# The connection's "API_KEY" auth type is used to carry a bearer token —
# EventBridge Connections don't have a distinct "bearer token" auth type,
# so this sets the Authorization header directly via the api_key_name/value
# pair, which is the documented way to do it.

resource "aws_cloudwatch_event_connection" "jobs_tick" {
  name           = "${var.project_name}-jobs-tick"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${random_password.cron_secret.result}"
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "jobs_tick" {
  name                = "${var.project_name}-jobs-tick"
  invocation_endpoint = "https://${var.domain_name}/api/v1/jobs/tick"
  http_method         = "POST"
  connection_arn      = aws_cloudwatch_event_connection.jobs_tick.arn
  invocation_rate_limit_per_second = 1
}

resource "aws_scheduler_schedule" "jobs_tick" {
  name       = "${var.project_name}-jobs-tick"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "rate(1 minute)"

  target {
    arn      = aws_cloudwatch_event_api_destination.jobs_tick.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 2
    }
  }
}
