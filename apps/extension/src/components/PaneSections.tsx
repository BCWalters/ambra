import type { FC, ReactNode } from "react";
import {
  Accordion, AccordionHeader, AccordionItem, AccordionPanel, Body1Strong,
} from "@fluentui/react-components";
import { CHROME_BORDER } from "../reader/chromeTheme.js";

export const PaneCard: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section style={{ padding: 14, border: `1px solid ${CHROME_BORDER}`, borderRadius: 10, background: "rgba(255, 255, 255, 0.22)" }}>
    <Body1Strong as="h3" block style={{ margin: "0 0 12px" }}>{title}</Body1Strong>
    {children}
  </section>
);

export const PaneDisclosure: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <Accordion collapsible style={{ borderTop: `1px solid ${CHROME_BORDER}`, marginTop: 20, paddingTop: 10 }}>
    <AccordionItem value="details">
      <AccordionHeader button={{ style: { padding: 0, minHeight: 32, color: "inherit" } }}>
        {title}
      </AccordionHeader>
      <AccordionPanel style={{ margin: 0 }}>
        <div style={{ paddingTop: 12 }}>{children}</div>
      </AccordionPanel>
    </AccordionItem>
  </Accordion>
);
