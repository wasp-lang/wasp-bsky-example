import { api, Spec } from "@wasp.sh/spec";

import {
  blueskyClientMetadata,
  blueskyJwks,
  loginWithBluesky,
  loginWithBlueskyCallback,
} from "./auth" with { type: "ref" };

export const bskySpec: Spec = [
  api("GET", "/auth/bluesky", loginWithBluesky, { auth: false }),
  api("GET", "/auth/bluesky/callback", loginWithBlueskyCallback, {
    auth: false,
  }),
  api("GET", "/auth/bluesky/client-metadata.json", blueskyClientMetadata, {
    auth: false,
  }),
  api("GET", "/auth/bluesky/jwks.json", blueskyJwks, { auth: false }),
];
