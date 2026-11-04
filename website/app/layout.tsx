import type { Metadata } from "next";
export const metadata:Metadata={title:"AI Asset Studio",description:"아이디어에서 확정된 이미지 에셋까지."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
