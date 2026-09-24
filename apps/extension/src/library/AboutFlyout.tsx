import type { FC } from "react";
import { HelpAboutFlyout, type HelpAboutFlyoutProps } from "../components/HelpAboutFlyout.js";

export type AboutFlyoutProps = HelpAboutFlyoutProps;

export const AboutFlyout: FC<AboutFlyoutProps> = (props) => <HelpAboutFlyout {...props} />;
