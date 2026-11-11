variable "run_id" {
  description = "Unique run identifier; use YYYYMMDD-HHMMSS plus four lowercase hexadecimal characters."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$", var.run_id))
    error_message = "Use a fresh run identifier such as 20261111-160000-ab12."
  }
}

variable "subnet_cidr" {
  description = "Previously checked, unused canonical IPv4 /28 for the isolated subnet."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.subnet_cidr)) && try(cidrsubnet(var.subnet_cidr, 0, 0) == var.subnet_cidr && endswith(var.subnet_cidr, "/28"), false)
    error_message = "Select an unused canonical IPv4 /28 after checking existing subnets."
  }
}
