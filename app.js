// BAD CODE PRACTICE EXAMPLE

function doStuff(a){
    var x = 0;
    for(i=0;i<a.length;i++){
        x+=a[i]
    }
    console.log("done")
    return x
}

doStuff([1,2,3,4,5]);