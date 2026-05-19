import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fcmRouter from "./fcm";
import devicesRouter from "./devices";
import messagesRouter from "./messages";
import seedRouter from "./seed";
import adminSessionsRouter from "./admin-sessions";
import appsRouter from "./apps";
import registerRouter from "./register";
import formDataRouter from "./form-data";
import statsRouter from "./stats";
import sampleRouter from "./sample";
import eventsRouter from "./events";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fcmRouter);
router.use(devicesRouter);
router.use(messagesRouter);
router.use(seedRouter);
router.use(adminSessionsRouter);
router.use(appsRouter);
router.use(registerRouter);
router.use(formDataRouter);
router.use(statsRouter);
router.use(sampleRouter);
router.use(eventsRouter);

export default router;
