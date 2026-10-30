data "google_compute_network" "vpc" {
  project = var.project_id
  name    = var.network_name
}

data "google_compute_subnetwork" "subnet" {
  project = var.project_id
  region  = var.region
  name    = var.subnet_name

  lifecycle {
    postcondition {
      condition     = self.network == data.google_compute_network.vpc.self_link
      error_message = "The subnet must belong to the selected existing VPC."
    }

    postcondition {
      condition = (
        var.pods_range_name != var.services_range_name &&
        contains([for range in self.secondary_ip_range : range.range_name], var.pods_range_name) &&
        contains([for range in self.secondary_ip_range : range.range_name], var.services_range_name)
      )
      error_message = "The distinct Pods and Services secondary ranges must already exist; apply the reviewed foundation change separately first."
    }

    postcondition {
      condition     = self.private_ip_google_access
      error_message = "Private Google Access must already be enabled on the subnet."
    }
  }
}
