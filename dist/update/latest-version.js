import axios from "axios";
export async function getLatestVersion() {
    const res = await axios.get("https://registry.npmjs.org/tenant-agent/latest", { timeout: 3000 });
    return res.data.version;
}
