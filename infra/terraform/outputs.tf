output "files_bucket" {
  description = "Value for GCS_BUCKET."
  value       = google_storage_bucket.files.name
}

output "server_service_account" {
  value = google_service_account.server.email
}

output "worker_service_account" {
  value = google_service_account.worker.email
}

output "neon_project_id" {
  value = neon_project.kitchen.id
}

output "neon_database_host" {
  description = "Direct (non-pooled) host."
  value       = neon_project.kitchen.database_host
}

# Display-only hiding: `terraform output neon_connection_uri` PRINTS THE
# PASSWORD, and state holds it in plain text. Do not run it in a shared terminal;
# copy it from the Neon console instead.
output "neon_connection_uri" {
  value     = neon_project.kitchen.connection_uri
  sensitive = true
}
