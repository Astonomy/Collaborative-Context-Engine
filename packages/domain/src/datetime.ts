import { z } from "zod";

export const dateTimeSchema = z.iso.datetime({ offset: true });

