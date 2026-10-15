# neon.tf — the Postgres database. DANGER: some arguments (region_id,
# pg_version, org_id) can't change in place; a plan that says "destroy and
# replace" would delete the database. prevent_destroy turns that into an error.
#
# If the Neon free plan refuses a second project, drop this resource and create
# a `neon_database` inside the GardenApp project instead (see README.md).

resource "neon_project" "kitchen" {
  name       = "KitchenDesign"
  org_id     = var.neon_org_id
  region_id  = "aws-us-east-1"
  pg_version = 18

  history_retention_seconds = 21600 # 6 h, the free-plan maximum

  store_password = "yes"

  autoscaling_limit_min_cu = 0.25
  autoscaling_limit_max_cu = 2
  suspend_timeout_seconds  = 0 # Neon default: suspend after 5 min idle

  lifecycle {
    prevent_destroy = true
  }
}
