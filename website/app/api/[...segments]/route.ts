import { env } from "cloudflare:workers";
import { handleApi } from "../../../lib/studio-api.mjs";
export const dynamic="force-dynamic";
export const GET=(request:Request)=>handleApi(request,env);
export const POST=(request:Request)=>handleApi(request,env);
export const PATCH=(request:Request)=>handleApi(request,env);
