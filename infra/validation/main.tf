locals {
  network_name = "c02-validation-${var.run_id}"
  subnet_name  = "${local.network_name}-subnet"
}

resource "google_compute_network" "validation" {
  project                 = "masterpoulet-dev"
  name                    = local.network_name
  description             = "Temporary isolated C02 reproducibility check ${var.run_id}"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "validation" {
  project                  = "masterpoulet-dev"
  region                   = "europe-west1"
  name                     = local.subnet_name
  description              = "Temporary isolated C02 reproducibility check ${var.run_id}"
  ip_cidr_range            = var.subnet_cidr
  network                  = google_compute_network.validation.id
  private_ip_google_access = true
}
