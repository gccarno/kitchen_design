# Credentials are not configured here. The google provider uses Application
# Default Credentials (`gcloud auth application-default login`); the neon
# provider reads NEON_API_KEY from the environment. Never put keys in .tf files.

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "neon" {}
