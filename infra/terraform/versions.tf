# versions.tf — Terraform and provider versions (same pins as the garden app).
# Commit .terraform.lock.hcl once `terraform init` has produced it.

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.18.0"
    }
  }

  # State lives in the garden repo's state bucket under its own prefix. That
  # bucket stays managed by the garden repo; this config only writes objects
  # under "kitchen-design/".
  backend "gcs" {
    bucket = "innate-conquest-491313-k3-tfstate"
    prefix = "kitchen-design"
  }
}
