import { z } from "zod";

export const venueSchema = z.object({
  name: z.string().trim().min(1, "Inserisci il nome della sede."),
  city: z.string().trim(),
  address: z.string().trim(),
  cuisine_type: z.string().trim(),
  description: z.string().trim(),
});

export type VenueForm = z.infer<typeof venueSchema>;
