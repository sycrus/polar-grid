// Recording 
let record = false;
let capturer = new CCapture({format:'png'});
const NUM_FRAMES = 720;

function recordKeypress() {
    if (record == false) {
      record = true;
      // frameCount = 0;
    } else {
      location.reload(); //refresh the page (starts animation over, stops saving frames)
    } 
  }

function myRecord() {
    if (record) capturer.start(); // start the animation capture
    if(record) {
      console.log("record");
      capturer.capture( canvas ); // if capture is 'true', save the frame
      if (frameCount-1 == NUM_FRAMES){ //stop and save after NUM_FRAMES
          capturer.stop(); 
          capturer.save(); 
          noLoop(); 
      }
    }
  }