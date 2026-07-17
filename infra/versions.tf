# FlowBoard — AWS ECS Fargate infrastructure.
#
# Single root module by design (no nested modules) — this is sized for a
# small internal team's deployment (one Fargate task, one small RDS
# instance), not a multi-environment platform. See infra/README.md for the
# full walkthrough.
#
# Not validated against a live AWS account by the author (no Terraform CLI
# / AWS credentials in the authoring environment) — run `terraform validate`
# after `terraform init` and review the plan carefully before applying.

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Uncomment and configure once you have a state backend (S3 + DynamoDB
  # lock table). Local state is fine to start, but doesn't survive a lost
  # laptop and can't be safely shared between people.
  #
  # backend "s3" {
  #   bucket         = "your-terraform-state-bucket"
  #   key            = "flowboard/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "flowboard"
      ManagedBy = "terraform"
    }
  }
}
