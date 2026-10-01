import { useEffect, useState, type FC } from "react";
import { Button, Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { ArrowSortRegular } from "@fluentui/react-icons";
import type { LibrarySortOption } from "./LibrarySortOption.js";
import { useTranslation } from "../i18n/LocaleContext.js";
import type { StringCatalog } from "../i18n/locales/en.js";

const labels: Record<LibrarySortOption, keyof StringCatalog> = {
  dateAddedDesc: "library.sortNewest", dateAddedAsc: "library.sortOldest",
  titleAsc: "library.sortTitle", authorAsc: "library.sortAuthor",
};

export const LibrarySortMenu: FC<{ sort: LibrarySortOption; onChange: (sort: LibrarySortOption) => void; active?: boolean }> = ({
  sort, onChange, active = true,
}) => {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  return (
    <Menu open={active && open} onOpenChange={(_event, data) => setOpen(data.open)}
      checkedValues={{ librarySort: [sort] }} onCheckedValueChange={(_event, data) => {
      if (data.name === "librarySort") onChange(data.checkedItems[0] as LibrarySortOption);
    }}>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<ArrowSortRegular />} aria-label={t("library.sort")}>{t("library.sortLabel")}</Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t("library.sortBy")}>
          {(Object.keys(labels) as LibrarySortOption[]).map((option) => (
            <MenuItemRadio key={option} name="librarySort" value={option}>{t(labels[option])}</MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};
