import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {projectRoot,readLegacyDocuments,bundleFromDocuments,loadArtifactSources,writeArtifactDocuments} from './artifact_store.mjs';

export async function migrateToArtifacts({root=projectRoot,removeLegacy=true}={}){
 const marker=path.join(root,'artifacts/manifest.json');
 try{await fs.access(marker);const current=await loadArtifactSources(root);console.log('Artifact sources already initialized.');return current;}catch(e){if(e.code!=='ENOENT')throw e;}
 const documents=await readLegacyDocuments(root),before=bundleFromDocuments(documents),result=await writeArtifactDocuments(documents,{root});
 if(!isDeepStrictEqual(before,result.bundle)||!isDeepStrictEqual(documents['additional-sources.json'],result.additionalSources))throw Error('Migration changed assembled source values; original JSON files have been retained.');
 if(removeLegacy){const directory=path.join(root,'docs/data');for(const name of Object.keys(documents)){if(!/^[a-z][a-z0-9.-]*\.json$/.test(name))throw Error('Unsafe legacy filename.');await fs.unlink(path.join(directory,name));}}
 console.log(JSON.stringify({wiki:result.bundle.research.articles.length,articles:result.bundle.research.editorial.articles.length,offers:Object.values(result.bundle.categories).reduce((n,c)=>n+c.offers.length,0),priceObservations:result.bundle.observations.length,refreshProfiles:result.additionalSources.products.length,removedLegacyJson:removeLegacy?Object.keys(documents).length:0}));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),flag=args.indexOf('--root');await migrateToArtifacts({root:flag>=0?path.resolve(args[flag+1]):projectRoot,removeLegacy:!args.includes('--keep-legacy')});}
