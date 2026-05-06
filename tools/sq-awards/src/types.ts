export interface SearchParams {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  cabinClass: 'economy' | 'premeconomy' | 'business' | 'first' | 'suites';
  passengers?: number;
}

export interface Flight {
  flightNo: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  aircraft: string;
  stops: number;
  cabinClass: string;
  availableSeats: string; // e.g. "Saver", "Advantage", "Waitlist" or count
  milesRequired: number | null;
  taxesAndFees: string | null;
}

export interface SearchResult {
  params: SearchParams;
  flights: Flight[];
  searchedAt: string;
  error?: string;
}

export interface RouteConfig {
  name: string;
  origin: string;
  destination: string;
  preferredTimeWindow?: { earliest: string; latest: string }; // HH:MM format
}
