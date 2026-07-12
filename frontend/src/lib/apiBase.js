export let API_BASE = "/api";

export function setActiveBusinessId(businessId) {
  API_BASE = businessId ? `/api/business/${businessId}` : "/api";
}
