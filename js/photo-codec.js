"use strict";

(() => {
    const fail = message => window.SmartHealth.validate.fail(message);
    const ascii = (bytes,start,length) => String.fromCharCode(...bytes.slice(start,start+length));
    function crc32(bytes) {
        let crc = -1;
        for (const byte of bytes) { crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
        return (crc^-1)>>>0;
    }
    function inspect(bytes) {
        const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        const bad = () => fail("This image is invalid or damaged. Choose a valid JPG, PNG, or WebP photo.");
        let width,height,type,hasMetadata=false;
        if (bytes.length >= 33 && ascii(bytes,0,8) === "\x89PNG\r\n\x1a\n") {
            type="image/png";
            if (ascii(bytes,12,4)!=="IHDR" || view.getUint32(8)!==13) bad();
            width=view.getUint32(16); height=view.getUint32(20);
            let offset=8, end=false, data=false;
            while (offset+12<=bytes.length) {
                const size=view.getUint32(offset), name=ascii(bytes,offset+4,4), next=offset+size+12;
                if (next>bytes.length || size>2097152) bad();
                if (crc32(bytes.subarray(offset+4,next-4))!==view.getUint32(next-4)) bad();
                if (name==="acTL" && (size!==8 || view.getUint32(offset+8)>1)) fail("Choose a still image rather than an animated photo.");
                if (name==="IDAT") data=true;
                if (name==="IEND") { if(size!==0) bad(); end=true; break; }
                offset=next;
            }
            if(!end || !data) bad();
        } else if(bytes.length>=20 && ascii(bytes,0,4)==="RIFF" && ascii(bytes,8,4)==="WEBP") {
            type="image/webp";
            const end=view.getUint32(4,true)+8;
            if(end>bytes.length || end<20) bad();
            let offset=12, image=false;
            while(offset+8<=end) {
                const name=ascii(bytes,offset,4), size=view.getUint32(offset+4,true), start=offset+8;
                if(["EXIF","XMP ","ICCP"].includes(name))hasMetadata=true;
                const next=start+size+(size%2);
                if(next>end) bad();
                if(name==="ANIM" || name==="ANMF" || (name==="VP8X" && (bytes[start]&2))) fail("Choose a still image rather than an animated photo.");
                if(name==="VP8X") { if(size!==10) bad(); width=1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16); height=1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16); }
                if(name==="VP8 ") { if(size<10 || ascii(bytes,start+3,3)!=="\x9d\x01\x2a") bad(); width??=view.getUint16(start+6,true)&16383; height??=view.getUint16(start+8,true)&16383; image=true; }
                if(name==="VP8L") { if(size<5 || bytes[start]!==0x2f) bad(); const packed=view.getUint32(start+1,true); width??=(packed&16383)+1; height??=((packed>>>14)&16383)+1; image=true; }
                offset=next;
            }
            if(!image || offset!==end) bad();
        } else if(bytes.length>=4 && bytes[0]===255 && bytes[1]===216) {
            type="image/jpeg";
            let offset=2, scan=false, end=false;
            while(offset<bytes.length) {
                if(bytes[offset++]!==255) bad();
                while(bytes[offset]===255) offset++;
                const marker=bytes[offset++];
                if(marker===0xd9) {end=true; break;}
                if(marker===0xda) {
                    scan=true;
                    for(let i=offset;i+1<bytes.length;i++) if(bytes[i]===255 && bytes[i+1]===0xd9) {end=true;break;}
                    break;
                }
                if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
                if(offset+2>bytes.length) bad();
                const size=view.getUint16(offset);
                if(size<2 || offset+size>bytes.length) bad();
                if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { if(size<8) bad(); height=view.getUint16(offset+3); width=view.getUint16(offset+5); }
                offset+=size;
            }
            if(!scan || !end) bad();
        } else bad();
        if(!width || !height) bad();
        if(width*height>16000000 || width>8192 || height>8192) fail("Choose an image with at most 16 million pixels and sides no larger than 8192 pixels.");
        return {width,height,type,hasMetadata};
    }
    async function normalize(file) {
        if(!(file instanceof Blob) || !file.size || file.size>2097152) fail("Choose a non-empty image of 2 MB or smaller.");
        const expected={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp"}[file.name?.split(".").pop().toLowerCase()];
        if(!expected) fail("Choose a JPG, JPEG, PNG, or WebP image.");
        const meta=inspect(new Uint8Array(await file.arrayBuffer()));
        if(meta.type!==expected || (file.type && file.type!==expected)) fail("The image content must match its JPG, PNG, or WebP file extension.");
        let image;
        try { image=await createImageBitmap(file,{imageOrientation:"from-image"}); }
        catch { fail("This image cannot be decoded. Choose a valid photo."); }
        try {
            const scale=Math.min(1,512/image.width,512/image.height);
            const canvas=document.createElement("canvas");
            canvas.width=Math.max(1,Math.round(image.width*scale)); canvas.height=Math.max(1,Math.round(image.height*scale));
            canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.85));
            if(!blob || blob.type!=="image/webp") fail("This browser cannot save WebP photos. Use a current Chrome, Edge, or Firefox browser.");
            return blob;
        } finally {image.close();}
    }
    const toBase64=blob=>new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result.split(",")[1]);
        reader.onerror=()=>reject(new Error("Unable to encode your photo for localStorage."));
        reader.readAsDataURL(blob);
    });
    window.SmartHealth.photos = {normalize,inspect,toBase64};
})();
