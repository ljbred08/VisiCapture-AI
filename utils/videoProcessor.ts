
export async function extractFrames(videoFile: File, intervalSeconds: number = 2): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const frames: string[] = [];

    video.src = URL.createObjectURL(videoFile);
    video.load();

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const duration = video.duration;
      let currentTime = 0;

      const captureNext = () => {
        // Removed the frames.length > 15 limit. 
        // Logic now relies on video duration and user-defined sampling interval.
        if (currentTime >= duration) {
          resolve(frames);
          return;
        }

        video.currentTime = currentTime;
      };

      video.onseeked = () => {
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL('image/jpeg', 0.8));
        }
        currentTime += intervalSeconds;
        captureNext();
      };

      captureNext();
    };

    video.onerror = (e) => reject(e);
  });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
}
