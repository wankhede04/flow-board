# ACM certificate for the ALB listener. DNS-validated. Since the domain
# (registered at GoDaddy, per infra/README.md) isn't in Route 53, this
# module can't create the validation record automatically — `terraform
# apply` will pause on aws_acm_certificate_validation until you add the
# CNAME it's waiting for (see the `acm_validation_*` outputs) at your DNS
# provider. Default timeout is 45 minutes; add the record promptly.

resource "aws_acm_certificate" "flowboard" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "flowboard" {
  certificate_arn         = aws_acm_certificate.flowboard.arn
  validation_record_fqdns = [for r in aws_acm_certificate.flowboard.domain_validation_options : r.resource_record_name]
}
