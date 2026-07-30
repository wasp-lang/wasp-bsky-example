const PUBLIC_APPVIEW_URL = "https://public.api.bsky.app";

export type BlueskyProfile = {
  handle: string;
  displayName?: string;
  avatar?: string;
};

/**
 * Reads a profile from Bluesky's public AppView. It needs no authorization, so
 * the `atproto` scope we ask for during login is enough.
 */
export async function getBlueskyProfile(did: string): Promise<BlueskyProfile> {
  const url = new URL("/xrpc/app.bsky.actor.getProfile", PUBLIC_APPVIEW_URL);
  url.searchParams.set("actor", did);

  const response = await fetch(url);
  if (!response.ok) {
    // A brand new account may not have reached the AppView yet. The DID is all
    // we need to log someone in, so don't fail the flow over a missing profile.
    console.warn(
      `Could not fetch the Bluesky profile for ${did}: ${response.status} ${response.statusText}`,
    );
    return { handle: did };
  }

  const profile = (await response.json()) as Partial<BlueskyProfile>;
  return {
    handle: profile.handle ?? did,
    displayName: profile.displayName,
    avatar: profile.avatar,
  };
}
