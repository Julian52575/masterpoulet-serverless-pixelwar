locals {
  bucket_name = coalesce(var.bucket_name, "${var.project_id}-frontend")
}

resource "google_storage_bucket" "frontend" {
  name                        = local.bucket_name
  location                    = var.region
  project                     = var.project_id
  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.storage]
}

resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.frontend.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_compute_backend_bucket" "frontend" {
  name        = "${var.project_id}-frontend-backend"
  bucket_name = google_storage_bucket.frontend.name
  project     = var.project_id
  enable_cdn  = true

  depends_on = [
    google_project_service.compute,
    google_storage_bucket.frontend
  ]
}

resource "google_compute_url_map" "frontend" {
  name            = "${var.project_id}-frontend-url-map"
  project         = var.project_id
  default_service = google_compute_backend_bucket.frontend.id
}

resource "google_compute_target_http_proxy" "frontend" {
  name    = "${var.project_id}-frontend-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.frontend.id
}

resource "google_compute_global_forwarding_rule" "frontend" {
  name                  = "${var.project_id}-frontend-lb"
  project               = var.project_id
  target                = google_compute_target_http_proxy.frontend.id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL"
}
