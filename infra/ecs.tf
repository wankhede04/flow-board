resource "aws_ecs_cluster" "flowboard" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Runs on Graviton (ARM64) Fargate — ~20% cheaper than x86 for the same
# cpu/memory, and the release pipeline already publishes a linux/arm64
# image (see .github/workflows/release.yml). If you ever push an
# amd64-only image here, change this to X86_64 or tasks will fail to start.
resource "aws_ecs_task_definition" "flowboard" {
  family                   = var.project_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn             = aws_iam_role.ecs_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "flowboard"
      image     = var.container_image
      essential = true

      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]

      environment = [
        { name = "APP_BASE_URL", value = "https://${var.domain_name}" },
        { name = "ALLOW_DEMO_LOGIN", value = "false" },
        # Background jobs are driven by EventBridge Scheduler instead (see
        # eventbridge.tf) — never enable the in-process scheduler here,
        # it's only safe with exactly one long-lived replica.
        { name = "ENABLE_SCHEDULER", value = "false" },
        # Public OAuth client identifiers — not secret, safe as plain env
        # vars. Their matching *_SECRET values live in Secrets Manager
        # (see secrets.tf); a sign-in button only appears once both the ID
        # here and the secret are set to real values.
        { name = "GOOGLE_CLIENT_ID", value = var.google_client_id },
        { name = "GITHUB_CLIENT_ID", value = var.github_client_id },
        { name = "AUTH_ALLOWED_EMAIL_DOMAINS", value = "" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
        { name = "CRON_SECRET", valueFrom = aws_secretsmanager_secret.cron_secret.arn },
        { name = "SLACK_SIGNING_SECRET", valueFrom = aws_secretsmanager_secret.slack_signing_secret.arn },
        { name = "SLACK_BOT_TOKEN", valueFrom = aws_secretsmanager_secret.slack_bot_token.arn },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.google_client_secret.arn },
        { name = "GITHUB_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.github_client_secret.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.flowboard.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
    }
  ])
}

resource "aws_ecs_service" "flowboard" {
  name            = "${var.project_name}-service"
  cluster         = aws_ecs_cluster.flowboard.id
  task_definition = aws_ecs_task_definition.flowboard.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_task.id]
    assign_public_ip = true # no NAT Gateway — see vpc.tf; locked down to ALB-only inbound
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.flowboard.arn
    container_name    = "flowboard"
    container_port    = 3000
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Auto-rollback: if a new task definition fails to reach a healthy steady
  # state, ECS reverts to the previous one on its own — no manual
  # intervention needed after a bad deploy.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # ACM must validate and the ALB listener must exist before ECS can attach.
  depends_on = [aws_lb_listener.https]

  lifecycle {
    ignore_changes = [
      task_definition, # updated by the GitHub Actions deploy workflow, not terraform apply
    ]
  }
}
