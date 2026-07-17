resource "random_password" "db" {
  length  = 32
  special = false # avoid characters that need escaping in a connection-string URL
}

resource "aws_db_subnet_group" "flowboard" {
  name       = "${var.project_name}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${var.project_name}-db-subnet-group" }
}

resource "aws_db_instance" "flowboard" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 3 # storage autoscaling ceiling
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "flowboard"
  username = "flowboard"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.flowboard.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # single-AZ — cost-optimized for a small internal team; flip to true for HA

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "03:00-04:00" # UTC — pick a low-traffic window for your team
  maintenance_window      = "mon:04:30-mon:05:30"

  deletion_protection      = var.db_deletion_protection
  skip_final_snapshot      = !var.db_deletion_protection
  final_snapshot_identifier = var.db_deletion_protection ? "${var.project_name}-db-final" : null

  tags = { Name = "${var.project_name}-db" }
}
