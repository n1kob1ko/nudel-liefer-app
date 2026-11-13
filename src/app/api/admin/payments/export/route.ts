import { billExportResponse } from "@/server/bill-export-api";

export function GET(request: Request) {
  return billExportResponse(request);
}
