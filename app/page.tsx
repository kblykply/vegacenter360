import Pano360, { examplePins, exampleCategories } from "./components/PanoTour";

export default function Page() {
  return (
    <div className="p-6 h-[100vh] ">
      <Pano360
        panoramaSrc="/360image.JPG"
        pins={examplePins}                 // replace with your real data
        categories={exampleCategories}     // set your neon colors here
        initialYaw={0}
        initialPitch={0}
        initialFov={65}
        autoRotate
      />
    </div>
  );
}
