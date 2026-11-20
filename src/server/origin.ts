import { z } from "zod";

export const siteOriginSchema = z.url().pipe(
  z.string().refine((value) => {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
    );
  }),
);
