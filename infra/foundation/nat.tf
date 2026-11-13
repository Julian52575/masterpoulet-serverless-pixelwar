resource "google_compute_router_nat" "nat" {
  count = var.enable_nat ? 1 : 0

  name                               = "${var.network_name}-nat"
  project                            = var.project_id
  region                             = var.region
  router                             = google_compute_router.router.name
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.subnet.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
}

moved {
  from = google_compute_router_nat.nat
  to   = google_compute_router_nat.nat[0]
}
