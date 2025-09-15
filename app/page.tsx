import Image from "next/image";
import PanoTour, { type Scene } from "./components/PanoTour";




export default function Home() {

  const scenes: Scene[] = [
    {
      id: "s1",
      title: "001",
      src: "/panos/DJI_20250906110907_0001_D.JPG",
      yaw: 0,
    },
    {
      id: "s2",
      title: "002",
      src: "/panos/DJI_20250906111241_0002_D.JPG", // check exact case/path
    },
    {
      id: "s3",
      title: "003",
      src: "/panos/DJI_20250906111510_0003_D.JPG",
      // ONLY this panorama gets pins:
      pins: [
        {
          id: "metro",
          yaw: 25, pitch: -4,                 // ← replace via Alt+Click
          label: "Metro",
          title: "Metro Station",
          badge: "Transport",
          description: "Direct line to city center.",
          image: "/pins/metro.jpg",
          distanceMinutes: 6,
          links: [{ href: "https://maps.google.com", text: "Open in Maps" }],
          color: "#22d3ee",
        },
        {
          id: "mall",
          yaw: -45, pitch: -2,                // ← replace via Alt+Click
          label: "Mall",
          title: "Vega Mall",
          badge: "Shopping",
          description: "150+ stores, cinema, food court.",
          image: "/pins/mall.jpg",
          distanceMinutes: 5,
          links: [{ href: "#contact", text: "Ask Sales" }],
          color: "#fbbf24",
        },
      ],
    },
    {
      id: "s4",
      title: "004",
      src: "/panos/DJI_20250906112148_0004_D.JPG",
    },
    {
      id: "s5",
      title: "006",
      src: "/panos/DJI_20250906113002_0006_D.JPG",
    },
  ];



  return (
    <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
          
          
          <PanoTour
            scenes={scenes}
            startId="s1"
            projectLogoSrc="/vegacenter-beyaz-logo.png    "
            companyLogoSrc="/NATA-logobeyaz.png"
            projectLogoAlt="Project"
            companyLogoAlt="Your Company"
          />
    </div>
  );
}
