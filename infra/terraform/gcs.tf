# gcs.tf — private bucket for photos and exports, and one robot per consumer.

resource "google_storage_bucket" "files" {
  name     = "kitchen-design-files"
  location = "US-EAST1" # immutable

  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced" # the app proxies every file

  soft_delete_policy {
    retention_duration_seconds = 604800 # 7 days (GCS default)
  }

  # Generated PDFs are disposable. Photos (projects/) are never expired.
  # NOTE: this matches "exports/" only when GCS_PREFIX is unset. Use no prefix in prod.
  lifecycle_rule {
    condition {
      age            = 7
      matches_prefix = ["exports/"]
    }
    action {
      type = "Delete"
    }
  }

  # Mirrors what Google applies to every new bucket (copied from the garden
  # buckets). Omitting it would make the plan show drift.
  encryption {
    google_managed_encryption_enforcement_config {
      restriction_mode = "NotRestricted"
    }
    customer_managed_encryption_enforcement_config {
      restriction_mode = "NotRestricted"
    }
    customer_supplied_encryption_enforcement_config {
      restriction_mode = "FullyRestricted"
    }
  }

  lifecycle {
    prevent_destroy = true # these are photos of the user's home
  }
}

# Used by the Render web service.
resource "google_service_account" "server" {
  account_id   = "kitchen-design-server"
  display_name = "kitchen-design-server"
  description  = "Render web service: read/write kitchen-design-files"
}

# Used by the Oracle worker (Phase 5).
resource "google_service_account" "worker" {
  account_id   = "kitchen-design-worker"
  display_name = "kitchen-design-worker"
  description  = "OCI worker: read/write kitchen-design-files"
}

# NOT managed here on purpose: service-account JSON keys. A
# google_service_account_key resource would write the private key into state.
# Create them with gcloud (see README.md).

# Additive grants (`_iam_member`), bucket-scoped only.
resource "google_storage_bucket_iam_member" "server_object_admin" {
  bucket = google_storage_bucket.files.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.server.member
}

resource "google_storage_bucket_iam_member" "worker_object_admin" {
  bucket = google_storage_bucket.files.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.worker.member
}
