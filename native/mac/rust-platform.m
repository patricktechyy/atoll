// C ABI for the Rust host. No Node, Electron or N-API is linked into this application.
#import <AppKit/AppKit.h>
#import <EventKit/EventKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <IOKit/ps/IOPowerSources.h>
#import <IOKit/ps/IOPSKeys.h>
#import <malloc/malloc.h>
#include <stdlib.h>
#include <string.h>
#pragma clang diagnostic ignored "-Wunguarded-availability-new"

void atoll_free(char *p) { free(p); }
void atoll_configure_window(void *pointer) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    void (^apply)(void)=^{
      window.level = NSScreenSaverWindowLevel;
      window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorStationary;
      window.backgroundColor = NSColor.clearColor;
      window.opaque = NO; window.hasShadow = NO;
    };
    if(NSThread.isMainThread) apply(); else dispatch_sync(dispatch_get_main_queue(),apply);
}
static NSDictionary *calendar(BOOL request) {
    EKEventStore *store = [[EKEventStore alloc] init];
    if (request) {
        dispatch_semaphore_t ready = dispatch_semaphore_create(0);
        void (^done)(BOOL,NSError *) = ^(BOOL granted,NSError *error) { (void)granted; (void)error; dispatch_semaphore_signal(ready); };
        if ([EKEventStore instancesRespondToSelector:@selector(requestFullAccessToEventsWithCompletion:)]) [store requestFullAccessToEventsWithCompletion:done];
        else [store requestAccessToEntityType:EKEntityTypeEvent completion:done];
        dispatch_semaphore_wait(ready, DISPATCH_TIME_FOREVER);
    }
    EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
    BOOL allowed = status == EKAuthorizationStatusAuthorized;
    if ([EKEventStore instancesRespondToSelector:@selector(requestFullAccessToEventsWithCompletion:)]) allowed = status == EKAuthorizationStatusFullAccess;
    NSMutableArray *calendars = [NSMutableArray array], *events = [NSMutableArray array];
    if (allowed) {
        for (EKCalendar *c in [store calendarsForEntityType:EKEntityTypeEvent]) [calendars addObject:@{@"id":c.calendarIdentifier,@"title":c.title ?: @"Calendar",@"account":c.source.title ?: @""}];
        NSDate *start = [NSDate dateWithTimeIntervalSinceNow:-43200], *end = [NSDate dateWithTimeIntervalSinceNow:604800];
        for (EKEvent *e in [[store eventsMatchingPredicate:[store predicateForEventsWithStartDate:start endDate:end calendars:nil]] sortedArrayUsingSelector:@selector(compareStartDateWithEvent:)]) {
            if (e.status == EKEventStatusCanceled) continue;
            [events addObject:@{@"id":[NSString stringWithFormat:@"%@/%@/%.0f",e.calendar.calendarIdentifier,e.eventIdentifier ?: @"",e.startDate.timeIntervalSince1970*1000],@"calendarId":e.calendar.calendarIdentifier,@"title":e.title ?: @"(No title)",@"start":@(e.startDate.timeIntervalSince1970*1000),@"end":@(e.endDate.timeIntervalSince1970*1000),@"allDay":@(e.allDay),@"location":e.location ?: @"",@"url":e.URL.absoluteString ?: @"",@"notes":e.notes ?: @""}];
            if (events.count >= 1000) break;
        }
    }
    return @{@"authorized":@(allowed),@"calendars":calendars,@"events":events,@"error":allowed ? NSNull.null : @"Allow Calendar access for Atoll in System Settings → Privacy & Security → Calendars."};
}
static char *platform_json_impl(const char *input) { @autoreleasepool {
    NSDictionary *q = [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:input] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSString *op = q[@"op"]; id value = @{};
    if ([op isEqual:@"screens"]) {
        NSMutableArray *all = [NSMutableArray array];
        for (NSScreen *s in NSScreen.screens) {
            CGFloat top=s.safeAreaInsets.top, left=top>0 ? NSMaxX(s.auxiliaryTopLeftArea)-NSMinX(s.frame):0, width=top>0?NSMinX(s.auxiliaryTopRightArea)-NSMaxX(s.auxiliaryTopLeftArea):0;
            CGDirectDisplayID d=[s.deviceDescription[@"NSScreenNumber"] unsignedIntValue]; CGRect b=CGDisplayBounds(d);
            [all addObject:@{@"id":@(d),@"name":s.localizedName ?: @"Screen",@"x":@(b.origin.x),@"y":@(b.origin.y),@"width":@(s.frame.size.width),@"height":@(s.frame.size.height),@"scaleFactor":@(s.backingScaleFactor),@"camera":@{@"x":@(left),@"y":@0,@"width":@(width),@"height":@(top)}}];
        } value=all;
    } else if ([op isEqual:@"calendar"]) value=calendar([q[@"request"] boolValue]);
    else if ([op isEqual:@"permissions"]) {
        EKAuthorizationStatus status=[EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
        BOOL allowed=status==EKAuthorizationStatusAuthorized;
        if ([EKEventStore instancesRespondToSelector:@selector(requestFullAccessToEventsWithCompletion:)]) allowed=status==EKAuthorizationStatusFullAccess;
        value=@{@"screen":CGPreflightScreenCaptureAccess()?@"granted":@"denied",@"accessibility":@(AXIsProcessTrusted()),@"calendar":@(allowed)};
    } else if ([op isEqual:@"request"]) {
        NSString *kind=q[@"kind"]; BOOL allowed=NO;
        if ([kind isEqual:@"screen"]) allowed=CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess();
        if ([kind isEqual:@"accessibility"]) allowed=AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString *)kAXTrustedCheckOptionPrompt:@YES});
        value=@{@"allowed":@(allowed)};
    } else if ([op isEqual:@"private-clipboard"]) {
        NSPasteboard *p=NSPasteboard.generalPasteboard;
        BOOL excluded=[p.types containsObject:@"org.nspasteboard.ConcealedType"] || [p.types containsObject:@"org.nspasteboard.TransientType"] || [p.types containsObject:@"org.nspasteboard.AutoGeneratedType"];
        value=@{@"private":@(excluded),@"sequence":@(p.changeCount)};
    } else if ([op isEqual:@"trim"]) {
        malloc_zone_pressure_relief(NULL,0); value=@{@"ok":@YES};
    } else if ([op isEqual:@"battery"]) {
        value=@{@"charging":@YES,@"level":@1,@"present":@NO};
        CFTypeRef info=IOPSCopyPowerSourcesInfo();
        if(info) {
            NSArray *sources=CFBridgingRelease(IOPSCopyPowerSourcesList(info));
            for(id source in sources) {
                NSDictionary *d=(__bridge NSDictionary *)IOPSGetPowerSourceDescription(info,(__bridge CFTypeRef)source);
                if(![d[@kIOPSTypeKey] isEqual:@kIOPSInternalBatteryType]) continue;
                double max=[d[@kIOPSMaxCapacityKey] doubleValue], current=[d[@kIOPSCurrentCapacityKey] doubleValue];
                value=@{@"charging":@([d[@kIOPSPowerSourceStateKey] isEqual:@kIOPSACPowerValue]),@"level":@(max>0?fmin(1,fmax(0,current/max)):1),@"present":@YES}; break;
            }
            CFRelease(info);
        }
    } else if ([op isEqual:@"icon"]) {
        NSImage *img=[NSWorkspace.sharedWorkspace iconForFile:q[@"path"] ?: @""];
        [img setSize:NSMakeSize(32,32)]; NSData *png=[[NSBitmapImageRep imageRepWithData:img.TIFFRepresentation] representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        value=@{@"data":[@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0] ?: @""]};
    }
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
    return strdup([[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] UTF8String] ?: "null");
} }
void atoll_position_window(void *pointer, double x,double y,double width,double height) {
    NSWindow *window=(__bridge NSWindow *)pointer;
    void (^apply)(void)=^{CGFloat primaryTop=NSMaxY(NSScreen.screens.firstObject.frame);[window setFrame:NSMakeRect(x,primaryTop-y-height,width,height) display:YES];};
    if(NSThread.isMainThread) apply(); else dispatch_sync(dispatch_get_main_queue(),apply);
}

char *atoll_platform_json(const char *input) {
    @autoreleasepool {
      NSDictionary *request=[NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:input] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
      if(NSThread.isMainThread || [request[@"op"] isEqual:@"calendar"]) return platform_json_impl(input);
      __block char *result=NULL;
      dispatch_sync(dispatch_get_main_queue(), ^{result=platform_json_impl(input);});
      return result;
    }
}
