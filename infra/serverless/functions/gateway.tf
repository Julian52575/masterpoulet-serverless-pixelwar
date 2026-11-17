locals {
  # Cloud Run URLs are predictable, so the gateway need not read them from the functions
  # (web-auth reads the gateway host: referencing the functions here would be a cycle).
  fn_url = {
    for fn in toset([for r in local.routes : r.fn]) :
    fn => "https://${fn}-${data.google_project.this.number}.${var.region}.run.app"
  }

  routes = {
    "/interactions"      = { method = "post", fn = "discord-proxy" }
    "/api/auth/login"    = { method = "get", fn = "web-auth" }
    "/api/auth/callback" = { method = "get", fn = "web-auth" }
    "/api/pixels"        = { method = "post", fn = "web-proxy" }
    "/api/brush"         = { method = "post", fn = "web-proxy" }
  }

  openapi = yamlencode({
    swagger = "2.0"
    info    = { title = "pixelwar", version = "1.0.0" }
    schemes = ["https"]
    paths = {
      for path, r in local.routes : path => {
        (r.method) = {
          operationId = replace(trimprefix("${r.method}${path}", "/"), "/[^a-zA-Z0-9]/", "_")
          responses   = { "200" = { description = "ok" } }
          "x-google-backend" = {
            address          = local.fn_url[r.fn]
            jwt_audience     = local.fn_url[r.fn]
            path_translation = "APPEND_PATH_TO_ADDRESS"
          }
        }
      }
    }
  })
}

resource "google_api_gateway_api" "api" {
  provider = google-beta
  api_id   = "pixelwar"

  depends_on = [google_project_service.api]
}

resource "google_api_gateway_api_config" "config" {
  provider      = google-beta
  api           = google_api_gateway_api.api.api_id
  api_config_id = "cfg-${substr(sha256(local.openapi), 0, 12)}"

  gateway_config {
    backend_config {
      google_service_account = google_service_account.function[local.gateway_sa_id].email
    }
  }

  openapi_documents {
    document {
      path     = "openapi.yaml"
      contents = base64encode(local.openapi)
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_api_gateway_gateway" "gateway" {
  provider   = google-beta
  region     = var.region
  api_config = google_api_gateway_api_config.config.id
  gateway_id = "pixelwar"
}
