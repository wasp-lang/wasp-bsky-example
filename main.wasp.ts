import { app, page, route } from "@wasp.sh/spec";

import { bskySpec } from "./src/bluesky/spec.wasp";

import { MainPage } from "./src/MainPage" with { type: "ref" };

export default app({
  name: "bskyLogin",
  wasp: { version: "^0.25.0" },
  title: "bsky-login",
  head: ["<link rel='icon' href='/favicon.ico' />"],

  auth: {
    userEntity: "User",
    onAuthFailedRedirectTo: "/",
    methods: {
      // Bluesky is wired up by hand below. Enabling a built-in OAuth provider
      // is what makes Wasp expose the OAuth helpers those handlers rely on, so
      // Google stays here with dummy credentials.
      google: {},
    },
  },

  spec: [route("RootRoute", "/", page(MainPage)), bskySpec],
});
