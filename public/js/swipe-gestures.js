// Touch Gesture Handler for Instagram-style Navigation
class SwipeGesture {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      threshold: options.threshold || 50, // Minimum distance for swipe
      allowedTime: options.allowedTime || 500, // Maximum time for swipe
      restraint: options.restraint || 100, // Maximum perpendicular distance
      ...options
    };
    
    this.startX = 0;
    this.startY = 0;
    this.distX = 0;
    this.distY = 0;
    this.startTime = 0;
    
    this.init();
  }
  
  init() {
    this.element.addEventListener('touchstart', this.handleTouchStart.bind(this), false);
    this.element.addEventListener('touchmove', this.handleTouchMove.bind(this), false);
    this.element.addEventListener('touchend', this.handleTouchEnd.bind(this), false);
  }
  
  handleTouchStart(e) {
    const touch = e.touches[0];
    this.startX = touch.pageX;
    this.startY = touch.pageY;
    this.startTime = new Date().getTime();
  }
  
  handleTouchMove(e) {
    // Prevent default only if we're swiping horizontally
    const touch = e.touches[0];
    this.distX = touch.pageX - this.startX;
    this.distY = touch.pageY - this.startY;
    
    if (Math.abs(this.distX) > Math.abs(this.distY)) {
      e.preventDefault();
    }
  }
  
  handleTouchEnd(e) {
    const elapsedTime = new Date().getTime() - this.startTime;
    
    // Check if swipe meets criteria
    if (elapsedTime <= this.options.allowedTime) {
      // Swipe right
      if (this.distX >= this.options.threshold && Math.abs(this.distY) <= this.options.restraint) {
        this.triggerEvent('swiperight');
      }
      // Swipe left
      else if (this.distX <= -this.options.threshold && Math.abs(this.distY) <= this.options.restraint) {
        this.triggerEvent('swipeleft');
      }
      // Swipe up
      else if (this.distY <= -this.options.threshold && Math.abs(this.distX) <= this.options.restraint) {
        this.triggerEvent('swipeup');
      }
      // Swipe down
      else if (this.distY >= this.options.threshold && Math.abs(this.distX) <= this.options.restraint) {
        this.triggerEvent('swipedown');
      }
    }
    
    // Reset
    this.startX = 0;
    this.startY = 0;
    this.distX = 0;
    this.distY = 0;
  }
  
  triggerEvent(eventName) {
    const event = new CustomEvent(eventName, {
      detail: {
        distX: this.distX,
        distY: this.distY,
        element: this.element
      }
    });
    this.element.dispatchEvent(event);
  }
  
  on(eventName, callback) {
    this.element.addEventListener(eventName, callback);
    return this;
  }
  
  off(eventName, callback) {
    this.element.removeEventListener(eventName, callback);
    return this;
  }
  
  destroy() {
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchmove', this.handleTouchMove);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
  }
}

// Instagram-specific swipe navigation
function initInstagramSwipeNavigation() {
  // Only on home page
  if (!window.location.pathname.includes('/home')) {
    return;
  }
  
  const mainContent = document.querySelector('.ig-main') || document.body;
  const swipe = new SwipeGesture(mainContent, {
    threshold: 100,
    allowedTime: 300
  });
  
  swipe.on('swiperight', () => {
    // Swipe right to go to messages
    window.location.href = '/messages';
  });
  
  swipe.on('swipeleft', () => {
    // Swipe left could go to explore/search in future
    // window.location.href = '/search';
  });
}

// Initialize swipe gestures when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInstagramSwipeNavigation);
} else {
  initInstagramSwipeNavigation();
}
