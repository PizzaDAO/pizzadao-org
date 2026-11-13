"use client";

import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import Hero from "@/app/(marketing)/_site/components/Hero";
import Mission from "@/app/(marketing)/_site/components/Mission";
import Timeline from "@/app/(marketing)/_site/components/Timeline";
import Mafia from "@/app/(marketing)/_site/components/Mafia";
import Work from "@/app/(marketing)/_site/components/Work";
import MomentReel from "@/app/(marketing)/_site/components/MomentReel";
import Reach from "@/app/(marketing)/_site/components/Reach";
import Sponsorship from "@/app/(marketing)/_site/components/Sponsorship";
import Journal from "@/app/(marketing)/_site/components/Journal";
import Join from "@/app/(marketing)/_site/components/Join";
import Footer from "@/app/(marketing)/_site/components/Footer";

const Index = () => {
  return (
    <main className="min-h-screen bg-cream text-ink">
      <SiteNav />
      <Hero />
      <Mission />
      <Timeline />
      <Mafia />
      <Work />
      <MomentReel />
      <Reach />
      <Sponsorship />
      <Journal />
      <Join />
      <Footer />
    </main>
  );
};

export default Index;
