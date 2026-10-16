import type { VideoChoice } from './playback';
type Fetcher=typeof fetch;
async function api(path:string,params:Record<string,string>,key:string,request:Fetcher){
  if(!key)throw new Error('YouTube discovery is not configured. Queued videos can still play continuously.');
  const url=new URL(`https://www.googleapis.com/youtube/v3/${path}`);url.search=new URLSearchParams({...params,key}).toString();
  const response=await request(url,{signal:AbortSignal.timeout(12000)});const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message||'YouTube discovery is temporarily unavailable.');return data;
}
export async function playlistPage(id:string,token:string,key:string,request:Fetcher=fetch):Promise<{items:VideoChoice[];nextToken:string|null}>{
  const page=await api('playlistItems',{part:'snippet',playlistId:id,maxResults:'20',...(token?{pageToken:token}:{})},key,request);
  const items=(page.items||[]).filter((v:{snippet:{title:string;resourceId?:{videoId:string}}})=>v.snippet.resourceId?.videoId&&!['Private video','Deleted video'].includes(v.snippet.title)).map((v:{snippet:{title:string;resourceId:{videoId:string}}})=>({id:v.snippet.resourceId.videoId,title:v.snippet.title}));
  return {items,nextToken:page.nextPageToken||null};
}
