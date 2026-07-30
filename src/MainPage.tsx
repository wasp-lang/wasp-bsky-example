import { config } from "wasp/client";
import { logout, useAuth } from "wasp/client/auth";
import Logo from "./assets/wasp-logo-rounded.svg";
import "./Main.css";

export function MainPage() {
  const { data: user } = useAuth();

  return (
    <main className="container">
      <img className="logo" src={Logo} alt="Wasp logo" />

      <h2 className="title">Welcome to Wasp!</h2>

      {user ? <Profile user={user} /> : <LoginForm />}
    </main>
  );
}

function LoginForm() {
  return (
    <>
      <p className="content">
        Log in with your Bluesky handle. Any AT Protocol account works, not just
        the ones hosted on <code>bsky.social</code>.
      </p>

      {/*
        A plain form navigation, not a fetch: the server sets a cookie holding
        the in-flight OAuth state and then redirects the browser on to Bluesky.
      */}
      <form
        className="login-form"
        method="get"
        action={`${config.apiUrl}/auth/bluesky`}
      >
        <input
          className="login-input"
          type="text"
          name="handle"
          placeholder="alice.bsky.social"
          autoComplete="username"
          required
        />
        <button className="button button-filled" type="submit">
          Log in with Bluesky
        </button>
      </form>
    </>
  );
}

function Profile({
  user,
}: {
  user: { handle: string; displayName: string | null; avatarUrl: string | null };
}) {
  return (
    <>
      {user.avatarUrl && (
        <img className="avatar" src={user.avatarUrl} alt={user.handle} />
      )}

      <p className="content">
        Logged in as {user.displayName ?? user.handle}
        <br />
        <code>@{user.handle}</code>
      </p>

      <div className="buttons">
        <button className="button button-outlined" onClick={logout}>
          Log out
        </button>
      </div>
    </>
  );
}
