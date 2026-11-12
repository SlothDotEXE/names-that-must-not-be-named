import struct

def package_names(d):
    start,size=struct.unpack_from('<II',d,24);pos=start;ns=[]
    while pos<start+size:
        hdr=int.from_bytes(d[pos:pos+2],'big');pos+=2;n=hdr&0x7fff;wide=bool(hdr&0x8000);sz=n*(2 if wide else 1)
        ns.append(d[pos:pos+sz].decode('utf-16-le' if wide else 'utf-8'));pos+=sz
    assert pos==start+size
    return ns

def zen_exports(d):
    ns=package_names(d);im,em,be,gd,gs=struct.unpack_from('<5I',d,40);cnt=(be-em)//72;hs=gd+gs;exports=[]
    for i in range(cnt):
        p=em+i*72;so,sz,ni,nn,outer,cl,su,templ,glob,flags,ff=struct.unpack_from('<QQIIQQQQQIB',d,p)
        exports.append(dict(index=i,name=ns[ni&0x3fffffff],name_number=nn,cooked_offset=so,size=sz,outer=outer,cls=cl))
    nh=(gd-be-cnt*16)//8
    bundles=[struct.unpack_from('<II',d,be+i*8) for i in range(nh)]
    commands=[struct.unpack_from('<II',d,be+nh*8+i*8) for i in range(cnt*2)]
    data_pos=hs
    for first,count in bundles:
        for ei,cmd in commands[first:first+count]:
            if cmd==1:exports[ei]['offset']=data_pos;data_pos+=exports[ei]['size']
    assert data_pos==len(d),(hex(data_pos),hex(len(d)))
    return ns,exports,commands
