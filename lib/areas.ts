// Launch neighborhoods: shown as one-tap shortcuts under the search box, with fixed
// coordinates so they never depend on geocoding. Order = launch priority.

export interface LaunchArea { name: string; lat: number; lng: number }

export const LAUNCH_AREAS: LaunchArea[] = [
  { name: "Silver Lake", lat: 34.0869, lng: -118.2702 },
  { name: "Downtown LA", lat: 34.0430, lng: -118.2500 },
  { name: "East LA", lat: 34.0239, lng: -118.1720 },
  { name: "South LA", lat: 33.9890, lng: -118.2780 },
  { name: "Culver City", lat: 34.0211, lng: -118.3965 },
  { name: "Santa Monica", lat: 34.0195, lng: -118.4912 },
  { name: "Manhattan Beach", lat: 33.8847, lng: -118.4109 },
  { name: "Torrance", lat: 33.8358, lng: -118.3406 },
  { name: "Long Beach", lat: 33.7701, lng: -118.1937 },
  // Neighbors of the launch areas with dense small-venue scenes.
  { name: "Echo Park", lat: 34.0782, lng: -118.2606 },
  { name: "Highland Park", lat: 34.1156, lng: -118.1926 },
  { name: "Koreatown", lat: 34.0616, lng: -118.3000 },
  { name: "Leimert Park", lat: 34.0050, lng: -118.3310 },
  { name: "Venice", lat: 33.9850, lng: -118.4695 },
  { name: "Hermosa & Redondo", lat: 33.8622, lng: -118.3995 },
];
