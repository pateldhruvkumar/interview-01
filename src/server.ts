import "dotenv-defaults/config";
import { createServer, IncomingMessage } from "http";
import { defaultPatient, main, type PatientData } from "./main";

const PORT = Number(process.env.PORT ?? 3000);

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/fill") {
    try {
      const body = await readJson(req);
      // Merge over defaults so a caller can send just { firstName, lastName }.
      const patient: PatientData = { ...defaultPatient, ...body };
      const result = await main(patient);
      res.writeHead(result.verified ? 200 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? String(err) }));
    }
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "POST /fill with patient JSON" }));
});

server.listen(PORT, () => console.log(`Agent API on http://localhost:${PORT}  (POST /fill)`));