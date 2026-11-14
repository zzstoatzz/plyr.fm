type FeedEnv = import("../src/feed").Env;
declare namespace Cloudflare {
  interface Env extends FeedEnv {}
}
