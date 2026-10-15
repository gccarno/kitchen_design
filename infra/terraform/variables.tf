variable "project_id" {
  description = "GCP project that owns the bucket and service accounts (shared with the garden app)."
  type        = string
  default     = "innate-conquest-491313-k3"
}

variable "region" {
  description = "Default region, next to Neon (aws-us-east-1) and Render (virginia)."
  type        = string
  default     = "us-east1"
}

variable "neon_org_id" {
  description = "Neon organization id (same org as the GardenApp project)."
  type        = string
  default     = "org-shy-boat-24481895"
}
