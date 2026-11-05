// Include dependency notices in the distributable; no build tools or their runtimes are bundled.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const metadata=JSON.parse(cp.execFileSync('cargo',['metadata','--locked','--format-version','1'],{cwd:path.join(root,'rust'),encoding:'utf8',maxBuffer:20*1024*1024}));
const texts=new Map(),packages=[];
for(const pkg of metadata.packages){
 const dir=path.dirname(pkg.manifest_path),names=fs.readdirSync(dir).filter(n=>/^(licen[cs]e|copying|copyright|notice)([-_.].*)?$/i.test(n)&&fs.statSync(path.join(dir,n)).isFile());
 if(pkg.license_file){const full=path.resolve(dir,pkg.license_file);if(fs.existsSync(full))names.push(path.relative(dir,full));}
 const refs=[];
 for(const name of new Set(names)){
  const text=fs.readFileSync(path.join(dir,name),'utf8'),id=crypto.createHash('sha256').update(text).digest('hex');
  if(!texts.has(id))texts.set(id,{number:texts.size+1,text});refs.push(texts.get(id).number);
 }
 packages.push(`${pkg.name} ${pkg.version} — ${pkg.license||'see notice'}${pkg.repository?' — '+pkg.repository:''}\nNotices: ${refs.join(', ')||'license identifier above'}`);
}
const out=path.join(root,'.cache/rust-notices.txt');
fs.writeFileSync(out,'Atoll\n'+fs.readFileSync(path.join(root,'LICENSE'),'utf8')+'\n\nDependency licenses\n\n'+packages.join('\n\n')+'\n\n'+[...texts.values()].map(v=>`Notice ${v.number}\n${'='.repeat(60)}\n${v.text}`).join('\n\n'));
console.log('Prepared Rust dependency notices');
