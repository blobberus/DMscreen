// Which version of the screen this is. The Pages build marks index.html and login.html with
// <meta name="dm-mode" content="site"> plus the repo it was built from; the PC server's pages have no
// mark. Tests point the GitHub addresses at a stand-in server with the dm-github-* metas.
const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';

export const SITE = meta('dm-mode') === 'site';
export const REPO = meta('dm-repo') || 'blobberus/DMscreen';
export const BRANCH = meta('dm-branch') || 'main';
export const GITHUB_API = meta('dm-github-api') || 'https://api.github.com';
export const GITHUB_RAW = meta('dm-github-raw') || 'https://raw.githubusercontent.com';
export const GITHUB_WEB = meta('dm-github-web') || 'https://github.com';
/** The private repo the sounds are kept in (read with each device's GitHub connection), or '' when the
 *  sounds are this repo's own sounds/ folder, published with the site. */
export const SOUNDS_REPO = meta('dm-sounds-repo');

/** iPad and iPhone (an iPad's Safari says it's a Mac, but a Mac has no touch screen). */
export const IOS = /iP(ad|hone|od)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
